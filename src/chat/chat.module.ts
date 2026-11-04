import { Module } from '@nestjs/common';
import { PlacesService } from '../places/places.service';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { GeminiProvider } from './providers/gemini.provider';
import { GroqProvider } from './providers/groq.provider';
import { LLM_PROVIDERS } from './providers/llm-provider';

@Module({
  controllers: [ChatController],
  providers: [
    ChatService,
    PlacesService,
    GeminiProvider,
    GroqProvider,
    // Para sumar otro agente (OpenAI, Claude, etc.): crea su provider y agrégalo aquí.
    {
      provide: LLM_PROVIDERS,
      useFactory: (gemini: GeminiProvider, groq: GroqProvider) => [gemini, groq],
      inject: [GeminiProvider, GroqProvider],
    },
  ],
  exports: [ChatService],
})
export class ChatModule {}