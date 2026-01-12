
/**
 * LLM utility for generating new elements using Cloudflare Workers AI
 */
export async function generateElements(ai: Ai, parentName: string): Promise<string[]> {
    const result = await ai.run('@cf/meta/llama-3.2-3b-instruct', {
      prompt: `
        You are a creative assistant that generates exactly 4 sub-elements 
        or related concepts for a given parent element in a discovery game. 
        Your response must be only the 4 names, separated by commas, no 
        other text.

        The parent element is: ${parentName}`
    });

    return result.response
      .split(',')
      .map((s: string) => s.trim())
      .filter((s: string) => s.length > 0)
      .slice(0, 4);

}
