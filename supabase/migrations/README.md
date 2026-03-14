# Supabase Migrations

SQL migration files live here, managed by the Supabase CLI.

## Setup (Milestone 2)

```bash
# Install the Supabase CLI
brew install supabase/tap/supabase        # macOS
# or: npm install -g supabase

# Link to your project
supabase login
supabase link --project-ref <your-project-ref>

# Apply all migrations to remote
supabase db push

# Or run locally with Docker
supabase start
```

## Migration naming convention

```
<timestamp>_<description>.sql
e.g.  20240101000000_create_profiles.sql
      20240101000001_create_anime.sql
```

## Tables (from DATABASE_SCHEMA.md)

Migrations to be created in Milestone 2:
- profiles
- anime
- user_anime
- user_rankings
- comparisons
- friends
- share_cards
