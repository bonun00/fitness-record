'use server';

import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export async function analyzeWorkout(text: string, history?: string) {
  const prompt = `Analyze the following workout description and extract exercises, sets, reps, and weights. 
  IMPORTANT: Always extract the exercise names in Korean (e.g., "스쿼트" instead of "Squat").
  
  Also, provide a "Data Insight" in Korean. 
  Focus on "Top Set" growth (the highest weight and reps performed today for each exercise).
  Compare it to the provided past history if available. 
  If no history is provided, focus on the quality of today's top set and its significance for muscle growth or strength.
  
  Example Insight: "🔥 탑 세트 돌파! 지난주 스쿼트 최고 중량은 100kg 3회였지만, 오늘은 100kg 5회를 밀어냈습니다. 근신경계가 완벽히 적응하고 있습니다."
  
  At the end of the insight, add a short, powerful motivational quote in Korean.
  Keep the entire response short, powerful, and data-driven.
  
  Workout description: "${text}"
  ${history ? `Past History (last few workouts): "${history}"` : ""}`;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          exercises: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING },
                sets: { type: Type.NUMBER },
                reps: { type: Type.NUMBER },
                weight: { type: Type.NUMBER },
                unit: { type: Type.STRING }
              },
              required: ["name"]
            }
          },
          analysis: { type: Type.STRING }
        },
        required: ["exercises", "analysis"]
      }
    }
  });

  const textResponse = response.text;
  if (!textResponse) {
    throw new Error("AI response was empty");
  }

  return JSON.parse(textResponse);
}
