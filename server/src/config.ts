import dotenv from 'dotenv';

dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  cfbdApiKey: process.env.CFBD_API_KEY || '',
  cfbdBaseUrl: 'https://api.collegefootballdata.com',
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-me',
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:4200').split(','),
};
