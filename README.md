# Detective Conan PH

The Filipino Detective Conan community — track episodes, join discussions, and prove your rank.

## Features

- **Track Episodes** — Log every case you watch — episodes, movies, specials and more
- **Story Arcs** — Follow the main plot from Season 1 to the latest era
- **Detective Rankings** — See how many episodes fellow detectives have cracked
- **Community Chat** — Drop into themed rooms, talk cases, and connect with other detectives
- **Auth** — Sign in, register, forgot password, and OAuth callback
- **Analytics** — Self analytics and tracking data
- **Admin** — Admin dashboard and controls

## Setup

### Prerequisites

- Node.js 18+
- Supabase project (with RLS enabled)

### Installation

```bash
npm install
```

### Environment Variables

Create a `.env.local` file with the following:

```
NEXT_PUBLIC_SUPABASE_URL=your-supabase-url
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
CRON_SECRET=your-cron-secret
```

### Run

```bash
npm run dev
```

### Database

Run `supabase/schema.sql` in the Supabase SQL Editor to create all tables.

## Development

```bash
npm run lint
npm run test
```

## License

Not affiliated with Gosho Aoyama.
