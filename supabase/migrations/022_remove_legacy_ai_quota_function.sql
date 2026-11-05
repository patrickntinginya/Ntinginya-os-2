BEGIN;

DROP FUNCTION IF EXISTS
  public.consume_ai_request(integer, integer, boolean);

COMMIT;
