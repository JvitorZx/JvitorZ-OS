import { google } from 'googleapis';
import { GoogleService } from './GoogleService';

export class YouTubeService {
  private getYouTubeClient() {
    // Cria o serviço de autenticação do Google
    const googleService = new GoogleService();

    // Obtém um cliente OAuth2 autenticado
    const client = googleService.getClient();

    // Cria o cliente da API do YouTube com o OAuth2Client
    return google.youtube({
      version: 'v3',
      auth: client,
    });
  }

  async getChannel(): Promise<unknown> {
    // Usa o cliente YouTube reutilizável para todas as chamadas de API.
    const youtube = this.getYouTubeClient();

    // Faz a chamada para listar o canal do usuário autenticado
    const response = await youtube.channels.list({
      part: ['snippet', 'statistics'],
      mine: true,
    });

    // Retorna a resposta da API para uso posterior
    return response;
  }

  getVideos(): void {
    // Responsável por listar vídeos do canal ou de uma playlist.
    // Esta função será usada para encapsular a chamada à API do YouTube Videos/PlaylistItems.
  }

  getVideo(videoId: string): void {
    // Responsável por buscar detalhes de um único vídeo pelo ID.
    // Esta função será usada para encapsular a chamada à API do YouTube Videos com o vídeo específico.
  }

  getPlaylists(): void {
    // Responsável por listar playlists do canal do usuário.
    // Esta função será usada para encapsular a chamada à API do YouTube Playlists.
  }

  getComments(): void {
    // Responsável por buscar comentários de vídeos ou de um canal.
    // Esta função será usada para encapsular a chamada à API do YouTube CommentThreads/Comments.
  }

  getAnalytics(): void {
    // Responsável por buscar métricas e relatórios analíticos do canal ou vídeos.
    // Esta função será usada para encapsular a chamada à API do YouTube Analytics.
  }
}
