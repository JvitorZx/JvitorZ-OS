import { YouTubeService } from '../../../services/YouTubeService';

type ChannelSummary = {
  title: string | null;
  id: string | null;
  subscribers: string | null;
  videoCount: string | null;
  viewCount: string | null;
  country: string | null;
  publishedAt: string | null;
};

export class ChannelModule {
  private youtubeService = new YouTubeService();

  async getChannelSummary(): Promise<ChannelSummary> {
    // Responsável por obter dados do canal e mapeá-los para a forma esperada pelo frontend.
    const response = await this.youtubeService.getChannel();
    const item = (response as any)?.data?.items?.[0] ?? {};
    const snippet = item.snippet ?? {};
    const statistics = item.statistics ?? {};

    return {
      title: snippet.title ?? null,
      id: item.id ?? null,
      subscribers: statistics.subscriberCount ?? null,
      videoCount: statistics.videoCount ?? null,
      viewCount: statistics.viewCount ?? null,
      country: snippet.country ?? null,
      publishedAt: snippet.publishedAt ?? null,
    };
  }
}
