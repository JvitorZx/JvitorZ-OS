import { google, youtube_v3 } from 'googleapis';
import { GoogleService } from '../../services/GoogleService';

export default class ChannelService {
  private getYouTubeClient(): youtube_v3.Youtube {
    const googleService = new GoogleService();
    const client = googleService.getClient();

    return google.youtube({
      version: 'v3',
      auth: client,
    });
  }

  async getChannelInfo(): Promise<Record<string, unknown>> {
    const youtubeClient = this.getYouTubeClient();

    const response = await youtubeClient.channels.list({
      part: ['snippet', 'statistics'],
      mine: true,
    });

    const channel = response.data.items?.[0];

    return {
      title: channel?.snippet?.title ?? null,
      id: channel?.id ?? null,
      subscribers: channel?.statistics?.subscriberCount ?? null,
      videoCount: channel?.statistics?.videoCount ?? null,
      viewCount: channel?.statistics?.viewCount ?? null,
      country: channel?.snippet?.country ?? null,
      publishedAt: channel?.snippet?.publishedAt ?? null,
    };
  }
}
