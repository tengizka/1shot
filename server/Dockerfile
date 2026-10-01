FROM denoland/deno:2.5.6
WORKDIR /app/server
COPY server/ ./
COPY supabase/migrations ./migrations
RUN deno cache main.ts
COPY index.html *.js *.css /app/web/
COPY assets /app/web/assets
USER deno
CMD ["run", "--allow-net", "--allow-env", "--allow-read=/app", "main.ts"]
