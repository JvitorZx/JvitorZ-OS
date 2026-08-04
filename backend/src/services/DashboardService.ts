import { YouTubeService } from './YouTubeService';

export class DashboardService {
  async getDashboard(): Promise<Record<string, unknown>> {
    const youtubeService = new YouTubeService();
    const channelResponse = await youtubeService.getChannel();

    // Organiza os dados do canal em um objeto simplificado para consumo do frontend
    const channel = (channelResponse as { data?: { items?: Array<Record<string, any>> } }).data?.items?.[0] ?? {};
    const snippet = channel.snippet ?? {};
    const statistics = channel.statistics ?? {};

    return {
      title: snippet.title ?? null,
      id: channel.id ?? null,
      subscribers: statistics.subscriberCount ?? null,
      videos: statistics.videoCount ?? null,
      views: statistics.viewCount ?? null,
      country: snippet.country ?? null,
      publishedAt: snippet.publishedAt ?? null,
    };
  }
}
