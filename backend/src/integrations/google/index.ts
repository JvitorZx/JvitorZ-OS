import GoogleAuth from './GoogleAuth';
import GoogleClient from './GoogleClient';

let googleAuthInstance: GoogleAuth | undefined;
let googleClientInstance: GoogleClient | undefined;

const getGoogleAuth = (): GoogleAuth => {
  googleAuthInstance ??= new GoogleAuth();
  return googleAuthInstance;
};

const getGoogleClient = (): GoogleClient => {
  googleClientInstance ??= new GoogleClient(getGoogleAuth());
  return googleClientInstance;
};

const googleAuth = new Proxy({} as GoogleAuth, {
  get(_target, property) {
    const value = getGoogleAuth()[property as keyof GoogleAuth];
    return typeof value === 'function' ? value.bind(getGoogleAuth()) : value;
  },
});

const googleClient = new Proxy({} as GoogleClient, {
  get(_target, property) {
    const value = getGoogleClient()[property as keyof GoogleClient];
    return typeof value === 'function' ? value.bind(getGoogleClient()) : value;
  },
});

export { GoogleAuth, GoogleClient, getGoogleAuth, getGoogleClient, googleAuth, googleClient };
