import { ChannelDataService } from '../../../services/ChannelDataService';

type ChannelSummary = {
  title: string | null;
  id: string | null;
  subscribers: string | null;
  videoCount: string | null;
  viewCount: string | null;
  country: string | null;
  publishedAt: string | null;
  integration: Awaited<ReturnType<ChannelDataService['getChannel']>>['integration'];
};

export class ChannelModule {
  constructor(private readonly channelData = new ChannelDataService()) {}

  async getChannelSummary(options: { refresh?: boolean } = {}): Promise<ChannelSummary> {
    return this.channelData.getChannel(options);
  }
}
