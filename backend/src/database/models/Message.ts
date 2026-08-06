export interface Message {
  id: string;
  conversationId: string;
  sender: 'user' | 'system' | 'operator';
  text: string;
  createdAt: string;
}
