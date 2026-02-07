import { API_URL } from '../config/api';

export { API_URL };

export const apiUrl = (path: string) =>
  `${API_URL}${path.startsWith('/') ? path : `/${path}`}`;
