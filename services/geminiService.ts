import { GoogleGenAI, GenerateContentResponse } from "@google/genai";
import { AIConfig } from "../types";

export interface AIModelInfo {
  id: string;      // 模型 ID（用于请求）
  name?: string;   // 模型名称（用于展示）
}

/**
 * 获取模型列表（Gemini 用 SDK models.list；OpenAI 兼容接口用 GET {baseUrl}/models）
 * @returns 模型数组；失败返回空数组
 */
export const fetchModels = async (config: AIConfig): Promise<AIModelInfo[]> => {
  if (!config.apiKey) return [];

  try {
    if (config.provider === 'gemini') {
      const ai = new GoogleGenAI({ apiKey: config.apiKey });
      const models: AIModelInfo[] = [];
      const pager = await ai.models.list();
      for await (const model of pager) {
        const id = (model.name || '').replace(/^models\//, '');
        if (id && /^(gemini|learnlm)/.test(id)) {
          models.push({ id, name: (model as any).displayName || id });
        }
      }
      return models;
    }

    // OpenAI 兼容（OpenAI / DeepSeek / 自定义）：GET {baseUrl}/models
    const baseUrl = (config.baseUrl || '').replace(/\/$/, '').replace(/\/chat\/completions$/, '');
    const url = `${baseUrl}/models`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
      },
    });
    if (!response.ok) return [];
    const data = await response.json();
    const list = data.data || data.models || [];
    return list.map((m: any) => ({
      id: m.id || '',
      name: m.name || m.id || '',
    })).filter((m: AIModelInfo) => m.id);
  } catch (e) {
    console.error("fetchModels error:", e);
    return [];
  }
};

/**
 * Helper to call OpenAI Compatible API
 */
const callOpenAICompatible = async (config: AIConfig, systemPrompt: string, userPrompt: string): Promise<string> => {
    try {
        let baseUrl = config.baseUrl.replace(/\/$/, '');
        // If user didn't provide full path, assume /v1/chat/completions logic or just trust them
        // Common convention: if URL ends with /v1, append /chat/completions
        if (!baseUrl.includes('/chat/completions')) {
            if (baseUrl.endsWith('/v1')) {
                baseUrl += '/chat/completions';
            } else {
                // If it's just a domain like api.openai.com, usually implies /v1/chat/completions
                // But let's assume user might input full path or standard base. 
                // To be safe, let's append /chat/completions if not present
                baseUrl += '/chat/completions';
            }
        }

        const response = await fetch(baseUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.apiKey}`
            },
            body: JSON.stringify({
                model: config.model,
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userPrompt }
                ],
                temperature: 0.7
            })
        });

        if (!response.ok) {
            const err = await response.text();
            console.error("OpenAI API Error:", err);
            return "";
        }

        const data = await response.json();
        return data.choices?.[0]?.message?.content?.trim() || "";
    } catch (e) {
        console.error("OpenAI Call Failed", e);
        return "";
    }
};

/**
 * Uses configured AI to generate a description
 */
export const generateLinkDescription = async (title: string, url: string, config: AIConfig): Promise<string> => {
  if (!config.apiKey) {
    return "请在设置中配置 API Key";
  }

  const prompt = `
      Title: ${title}
      URL: ${url}
      Please write a very short description (max 15 words) in Chinese (Simplified) that explains what this website is for. Return ONLY the description text. No quotes.
  `;

  try {
    if (config.provider === 'gemini') {
        const ai = new GoogleGenAI({ apiKey: config.apiKey });
        // Use user defined model or fallback
        const modelName = config.model || 'gemini-2.5-flash';
        
        const response: GenerateContentResponse = await ai.models.generateContent({
            model: modelName,
            contents: `I have a website bookmark. ${prompt}`,
        });
        return response.text ? response.text.trim() : "无法生成描述";
    } else {
        // OpenAI Compatible
        const result = await callOpenAICompatible(
            config, 
            "You are a helpful assistant that summarizes website bookmarks.", 
            prompt
        );
        return result || "生成描述失败";
    }
  } catch (error) {
    console.error("AI generation error:", error);
    return "生成描述失败";
  }
};

/**
 * Suggests a category
 */
export const suggestCategory = async (title: string, url: string, categories: {id: string, name: string}[], config: AIConfig): Promise<string | null> => {
    if (!config.apiKey) return null;

    const catList = categories.map(c => `${c.id}: ${c.name}`).join('\n');
    const prompt = `
        Website: "${title}" (${url})

        Available Categories:
        ${catList}

        Return ONLY the 'id' of the best matching category. If unsure, return 'common'.
    `;

    try {
        if (config.provider === 'gemini') {
            const ai = new GoogleGenAI({ apiKey: config.apiKey });
            const modelName = config.model || 'gemini-2.5-flash';
            
            const response: GenerateContentResponse = await ai.models.generateContent({
                model: modelName,
                contents: `Task: Categorize this website.\n${prompt}`,
            });
            return response.text ? response.text.trim() : null;
        } else {
             // OpenAI Compatible
            const result = await callOpenAICompatible(
                config,
                "You are an intelligent classification assistant. You only output the category ID.",
                prompt
            );
            return result || null;
        }
    } catch (e) {
        console.error(e);
        return null;
    }
}

/**
 * 组装翻译系统提示词（角色 + 行业 + 翻译要求 + 自定义补充）
 * @param tc 翻译配置（role/industry/requirements/prompt）
 * @param targetName 目标语言名称（动态注入）
 */
export const buildTranslateSystemPrompt = (
    tc: { role?: string; industry?: string; requirements?: string[]; prompt?: string } | undefined,
    targetName: string
): string => {
    const parts: string[] = [];

    // 角色设定
    const role = (tc?.role || '').trim();
    parts.push(`你是${role || '专业翻译助手'}。`);

    // 行业领域
    const industry = (tc?.industry || '').trim();
    if (industry && industry !== '通用') {
        parts.push(`当前翻译领域：${industry}行业。请严格使用该行业的专业术语与惯用表达，确保译文专业准确。`);
    }

    // 翻译要求（多选）
    const reqs = (tc?.requirements || []).filter(Boolean);
    if (reqs.length > 0) {
        parts.push(`翻译要求：\n- ${reqs.join('\n- ')}`);
    }

    // 自定义补充提示词
    const custom = (tc?.prompt || '').trim();
    if (custom) {
        parts.push(custom);
    }

    // 收尾约束
    parts.push(`目标语言：${targetName}。只输出翻译结果，不要任何解释或额外内容。`);
    return parts.join('\n');
};

/**
 * 流式翻译：逐字（chunk）输出翻译结果，实现打字机效果
 * @param text 待翻译内容
 * @param targetLang 目标语言代码
 * @param config AI 配置
 * @param translateConfig 翻译配置（角色/行业/要求/自定义提示词）
 * @param onChunk 每收到一段增量文本时回调
 * @param signal 可选 AbortController 信号（取消翻译）
 */
export const translateTextStream = async (
    text: string,
    targetLang: string,
    config: AIConfig,
    translateConfig: { role?: string; industry?: string; requirements?: string[]; prompt?: string } | undefined,
    onChunk: (delta: string) => void,
    signal?: AbortSignal
): Promise<string> => {
    if (!config.apiKey) return '';
    if (!text.trim()) return '';

    const langNames: Record<string, string> = {
        'zh-CN': '简体中文', 'en': 'English', 'ja': '日本語', 'ko': '한국어',
        'fr': 'Français', 'de': 'Deutsch', 'es': 'Español', 'ru': 'Русский',
    };
    const targetName = langNames[targetLang] || targetLang;

    // 结构化组装系统提示词（角色/行业/要求/自定义）
    const systemPrompt = buildTranslateSystemPrompt(translateConfig, targetName);
    const userPrompt = `需要翻译的内容：\n${text}`;

    let full = '';

    try {
        if (config.provider === 'gemini') {
            const ai = new GoogleGenAI({ apiKey: config.apiKey });
            const modelName = config.model || 'gemini-2.5-flash';
            const stream = await ai.models.generateContentStream({
                model: modelName,
                contents: `${systemPrompt}\n\n${userPrompt}`,
            });
            for await (const chunk of stream) {
                if (signal?.aborted) return full.trim();
                const delta = chunk.text;
                if (delta) {
                    full += delta;
                    onChunk(delta);
                }
            }
        } else {
            // OpenAI 兼容流式（DeepSeek / OpenAI / Claude 兼容等）
            let baseUrl = config.baseUrl.replace(/\/$/, '');
            if (!baseUrl.includes('/chat/completions')) {
                if (baseUrl.endsWith('/v1')) {
                    baseUrl += '/chat/completions';
                } else {
                    baseUrl += '/chat/completions';
                }
            }

            const response = await fetch(baseUrl, {
                method: 'POST',
                signal,
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${config.apiKey}`,
                },
                body: JSON.stringify({
                    model: config.model,
                    messages: [
                        { role: "system", content: systemPrompt },
                        { role: "user", content: userPrompt },
                    ],
                    temperature: 0.3,
                    stream: true,
                }),
            });

            if (!response.ok || !response.body) {
                const errBody = await response.text().catch(() => '');
                console.error("Streaming API error:", response.status, errBody);
                throw new Error(`翻译服务请求失败 (HTTP ${response.status})`);
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed.startsWith('data:')) continue;
                    const payload = trimmed.slice(5).trim();
                    if (payload === '[DONE]') return full.trim();
                    try {
                        const json = JSON.parse(payload);
                        const delta = json.choices?.[0]?.delta?.content;
                        if (delta) {
                            full += delta;
                            onChunk(delta);
                        }
                    } catch { /* 忽略解析失败的行 */ }
                }
            }
        }
    } catch (e: any) {
        if (e?.name === 'AbortError') {
            return full.trim();
        }
        console.error("AI streaming translation error:", e);
        // 重新抛出，让调用方（TranslateTool）能展示明确的错误提示
        throw e;
    }

    return full.trim();
};
