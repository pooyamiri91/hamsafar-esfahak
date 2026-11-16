import { db } from '../../db/index.js';
import { createApi } from './api.js';
export default createApi(db);
export const config = { path: '/api/*' };
