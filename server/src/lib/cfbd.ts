import axios from 'axios';
import { config } from '../config';

// Axios instance for the College Football Data API.
// The API key never leaves the server; the client always goes through our proxy.
export const cfbdApi = axios.create({
  baseURL: config.cfbdBaseUrl,
  headers: {
    Authorization: `Bearer ${config.cfbdApiKey}`,
  },
});
