import { google, youtube_v3 } from 'googleapis';
import GoogleAuth from './GoogleAuth';

export default class GoogleClient {
  private googleAuth: GoogleAuth;

  constructor(googleAuth?: GoogleAuth) {
    this.googleAuth = googleAuth || new GoogleAuth();
  }

  getYouTubeClient(): youtube_v3.Youtube {
    return google.youtube({
      version: 'v3',
      auth: this.googleAuth.getClient(),
    });
  }
}
