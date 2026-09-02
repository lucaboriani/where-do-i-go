# Self-hosting must stay possible: "self-hostable the whole way down" is a
# product claim, not an aspiration (decisions.md §13, invariant 7).
#
# Node 22 specifically — @inrupt/solid-client excludes 24 and
# @inrupt/solid-client-authn-core excludes 20. See docs/versions.md.
FROM node:22.23.2-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22.23.2-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# POD_ROOT is read at build time for next/image remotePatterns, and the build
# reads the Pod for generateStaticParams (decisions.md §22). A build with an
# unreachable Pod is expected to fail loudly rather than ship an empty site.
ARG POD_ROOT
ENV POD_ROOT=$POD_ROOT
RUN npm run build

FROM node:22.23.2-slim AS run
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
EXPOSE 3000
CMD ["npm", "run", "start"]
