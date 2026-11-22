// Edge Function: POST /api/llm — заключение от LLM потоком (заключение пишется до 1–2 минут;
// обычная функция Netlify оборвала бы ответ раньше). Логика — handleLlm() в lib/llm.mjs.
import { handleLlm } from "../../lib/llm.mjs";
import { PROMPTS, LLM_CONFIG } from "../../lib/generated.mjs";

export default (request) => handleLlm(request, { env: (name) => Netlify.env.get(name) || "", llmCfg: LLM_CONFIG, prompts: PROMPTS });

export const config = { path: "/api/llm" };
