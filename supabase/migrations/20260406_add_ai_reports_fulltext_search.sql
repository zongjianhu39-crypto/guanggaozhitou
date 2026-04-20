-- 2026-04-06: Add full-text search and trigram indexes for ai_reports

-- Ensure pg_trgm extension for trigram indexes
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Add tsvector column to store combined searchable content
ALTER TABLE ai_reports
  ADD COLUMN IF NOT EXISTS search_vector tsvector;

-- Backfill existing rows
UPDATE ai_reports
SET search_vector = to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(summary, '') || ' ' || coalesce(raw_markdown, ''))
WHERE search_vector IS NULL;

-- Trigger function to maintain search_vector
CREATE OR REPLACE FUNCTION ai_reports_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector := to_tsvector('simple', coalesce(NEW.title, '') || ' ' || coalesce(NEW.summary, '') || ' ' || coalesce(NEW.raw_markdown, ''));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Ensure trigger exists (drop if exists then create)
DROP TRIGGER IF EXISTS ai_reports_search_vector_trigger ON ai_reports;
CREATE TRIGGER ai_reports_search_vector_trigger
BEFORE INSERT OR UPDATE ON ai_reports
FOR EACH ROW EXECUTE PROCEDURE ai_reports_search_vector_update();

-- Create GIN index for tsvector
CREATE INDEX IF NOT EXISTS idx_ai_reports_search_vector ON ai_reports USING gin (search_vector);

-- Create trigram GIN indexes for fast LIKE/%/ searches on title and summary
CREATE INDEX IF NOT EXISTS idx_ai_reports_title_trgm ON ai_reports USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_ai_reports_summary_trgm ON ai_reports USING gin (summary gin_trgm_ops);

-- Optionally, you can tune the text search configuration for Chinese or other languages.
-- For deployment, consider replacing 'simple' with a more appropriate dictionary if available.
