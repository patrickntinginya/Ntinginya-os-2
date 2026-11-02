import { supabase } from '../lib/supabase'
import { createChatService } from './chat'

/** The chat service bound to the real Supabase client. Screens import this; tests import createChatService and pass a fake. */
export const chat = createChatService(supabase)
