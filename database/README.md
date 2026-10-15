# Database files

`schema.sql` is the readable end state of the Prisma migrations, including exclusion constraints and other SQL that Prisma cannot model. `seed.sql` loads the fictional Harbor Light demo clinic.

| File         | Purpose                                    |
| ------------ | ------------------------------------------ |
| `schema.sql` | Full DDL for an empty database or a review |
| `seed.sql`   | Repeatable demo data, safe to run again    |

Do not run `schema.sql` on a database Prisma Migrate already manages. Apply `apps/api/prisma/migrations` with `npm run db:deploy`, then seed:

```powershell
npm run db:deploy
npm run db:seed
```

`npm run db:seed` executes `seed.sql`. The demo password and token digest are documented in that file and in `docs/database.md`. The password is not stored in the database.

When `apps/api/prisma/schema.prisma` or a migration changes, update `schema.sql` in the same change. The catalog test compares the two.
