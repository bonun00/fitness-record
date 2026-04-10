'use client';

import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.NEXT_PUBLIC_GEMINI_API_KEY });

export async function analyzeWorkout(text: string) {
  const prompt = `Analyze the following workout description and extract exercises, sets, reps, and weights. 
  Also provide a brief encouraging analysis of the workout.
  
  Workout description: "${text}"`;

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

  return JSON.parse(response.text);
}
