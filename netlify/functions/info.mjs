// Функция Netlify: /api/info. Логика — в lib/handlers.mjs (её же использует dev-server.mjs).
import { info } from "../../lib/handlers.mjs";

export default (req, context) => info(req, { ip: context.ip });

export const config = { path: "/api/info" };
