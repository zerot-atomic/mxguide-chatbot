import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiKeyGuard } from '../common/api-key.guard';
import { ChatResponse, ChatService } from './chat.service';
import { ChatRequestDto } from './dto/chat-request.dto';

@Controller('chat')
@UseGuards(ApiKeyGuard)
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  /** POST /chat → { reply, format, kind, code, provider, places, suggestions } (ver docs/chatbot/CONTRATO_RESPUESTAS.md) */
  @Post()
  @HttpCode(200)
  chat(@Body() dto: ChatRequestDto): Promise<ChatResponse> {
    return this.chatService.chat(dto);
  }
}
