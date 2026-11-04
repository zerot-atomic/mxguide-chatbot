import { Module } from '@nestjs/common';
import { PlacesService } from '../places/places.service';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { GeminiProvider } from './providers/gemini.provider';
import { GrokProvider } from './providers/grok.provider';
import { LLM_PROVIDERS } from './providers/llm-provider';

@Module({
  controllers: [ChatController],
  providers: [
    ChatService,
    PlacesService,
    GeminiProvider,
    GrokProvider,
    // Para sumar otro agente (OpenAI, Claude, etc.): crea su provider y agrégalo aquí.
    {
      provide: LLM_PROVIDERS,
      useFactory: (gemini: GeminiProvider, grok: GrokProvider) => [gemini, grok],
      inject: [GeminiProvider, GrokProvider],
    },
  ],
  exports: [ChatService],
})
export class ChatModule {}
