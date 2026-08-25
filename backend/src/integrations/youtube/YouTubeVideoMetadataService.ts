import { google, type youtube_v3 } from 'googleapis';
import { GoogleService } from '../../services/GoogleService';
import {
  toSafeYouTubeAnalyticsError,
  YouTubeAnalyticsNotAuthorizedError,
  YouTubeAnalyticsNotConfiguredError,
  YouTubeVideoNotFoundError,
} from './YouTubeAnalyticsErrors';

export interface YouTubeVideoMetadata {
  videoId: string;
  title: string;
  publishedAt: string | null;
  durationSeconds: number | null;
}

export interface YouTubeVideoMetadataProvider {
  getByIds(videoIds: readonly string[]): Promise<Map<string, YouTubeVideoMetadata>>;
  listRecentVideoIds(limit: number): Promise<string[]>;
}

type YouTubeClientFactory = () => youtube_v3.Youtube;

export const parseYouTubeDurationSeconds = (duration: string | null | undefined): number | null => {
  if (!duration) return null;
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(duration);
  if (!match) return null;
  return Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
};

export class YouTubeVideoMetadataService implements YouTubeVideoMetadataProvider {
  private readonly googleService: GoogleService;
  private readonly clientFactory?: YouTubeClientFactory;

  constructor(googleService: GoogleService = new GoogleService(), clientFactory?: YouTubeClientFactory) {
    this.googleService = googleService;
    this.clientFactory = clientFactory;
  }

  private getClient(): youtube_v3.Youtube {
    if (!this.googleService.isConfigured()) throw new YouTubeAnalyticsNotConfiguredError();
    if (!this.googleService.isAuthenticated()) throw new YouTubeAnalyticsNotAuthorizedError();
    return this.clientFactory?.() ?? google.youtube({
      version: 'v3',
      auth: this.googleService.getClient(),
    });
  }

  async getByIds(videoIds: readonly string[]): Promise<Map<string, YouTubeVideoMetadata>> {
    if (videoIds.length === 0) return new Map();
    try {
      const client = this.getClient();
      const result = new Map<string, YouTubeVideoMetadata>();
      for (let index = 0; index < videoIds.length; index += 50) {
        const ids = videoIds.slice(index, index + 50);
        const response = await client.videos.list({
          part: ['snippet', 'contentDetails'],
          id: [...ids],
          maxResults: ids.length,
        });
        for (const item of response.data.items ?? []) {
          if (!item.id || !item.snippet?.title) continue;
          result.set(item.id, {
            videoId: item.id,
            title: item.snippet.title,
            publishedAt: item.snippet.publishedAt ?? null,
            durationSeconds: parseYouTubeDurationSeconds(item.contentDetails?.duration),
          });
        }
      }
      return result;
    } catch (error) {
      throw toSafeYouTubeAnalyticsError(error);
    }
  }

  async listRecentVideoIds(limit: number): Promise<string[]> {
    try {
      const client = this.getClient();
      const channelResponse = await client.channels.list({
        part: ['contentDetails'],
        mine: true,
        maxResults: 1,
      });
      const uploads = channelResponse.data.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
      if (!uploads) throw new YouTubeAnalyticsNotAuthorizedError();
      const playlistResponse = await client.playlistItems.list({
        part: ['contentDetails'],
        playlistId: uploads,
        maxResults: limit,
      });
      return (playlistResponse.data.items ?? []).flatMap((item) => (
        item.contentDetails?.videoId ? [item.contentDetails.videoId] : []
      ));
    } catch (error) {
      throw toSafeYouTubeAnalyticsError(error);
    }
  }

  async requireVideo(videoId: string): Promise<YouTubeVideoMetadata> {
    const metadata = await this.getByIds([videoId]);
    const video = metadata.get(videoId);
    if (!video) throw new YouTubeVideoNotFoundError();
    return video;
  }
}
