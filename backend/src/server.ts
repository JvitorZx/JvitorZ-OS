import 'dotenv/config';
import app from './app';

const port = Number(process.env.PORT || 4000);

app.listen(port, () => {
  console.log(`JvitorZ OS backend running on port ${port}`);
});
