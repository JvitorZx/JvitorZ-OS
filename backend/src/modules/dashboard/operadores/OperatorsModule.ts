import { ChannelOperatorService } from '../../../services/channel-operators';

export class OperatorsModule {
  constructor(private readonly channelOperators = new ChannelOperatorService()) {}

  async getOperatorsStatus() {
    const operators = await this.channelOperators.list();
    return {
      availableOperators: operators.filter(({ status }) => status === 'AVAILABLE').map(({ id }) => id),
      limitedOperators: operators.filter(({ status }) => status === 'LIMITED').map(({ id }) => id),
      activeOperators: operators.filter(({ status }) => status !== 'NOT_CONFIGURED').map(({ id }) => id),
      items: operators,
    };
  }
}
