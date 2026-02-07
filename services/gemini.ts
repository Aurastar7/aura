
import { GoogleGenAI, Type } from "@google/genai";
import { Post } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });

export const getSmartSortedFeed = async (posts: Post[], userInterests: string[]) => {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Given these user interests: ${userInterests.join(', ')} and these posts: ${JSON.stringify(posts.map(p => ({id: p.id, text: p.text})))}, return the IDs of the posts sorted by relevance to the user's interests.`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: { type: Type.STRING }
        }
      }
    });

    const sortedIds = JSON.parse(response.text);
    return posts.sort((a, b) => sortedIds.indexOf(a.id) - sortedIds.indexOf(b.id));
  } catch (error) {
    console.error("Gemini sorting failed, falling back to chronological", error);
    return posts;
  }
};

export const suggestBio = async (currentBio: string) => {
    try {
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Improve this social media bio to be more engaging and premium: "${currentBio}"`,
        config: {
          systemInstruction: "You are a professional social media manager. Keep it short and elegant.",
        }
      });
      return response.text;
    } catch (error) {
      return currentBio;
    }
};
