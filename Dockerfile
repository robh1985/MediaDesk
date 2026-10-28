FROM node:22-alpine
# ffmpeg lets the Preview app play any video or audio format. LibreOffice (large) adds high-quality
# previews of Office documents: build with --build-arg WITH_OFFICE=true to include it.
ARG WITH_OFFICE=false
RUN apk add --no-cache ffmpeg && if [ "$WITH_OFFICE" = "true" ]; then apk add --no-cache libreoffice ttf-dejavu ttf-liberation; fi
WORKDIR /app
COPY package.json server.js files.js appsettings.js notify.js mock.js mock-plex.js mock-games.js mock-pikvm.js games.js pikvm.js wallpapers.js media.js ./
COPY public ./public
ENV NODE_ENV=production PORT=8080 CONFIG_PATH=/config/config.json
VOLUME /config
EXPOSE 8080
USER node
CMD ["node", "server.js"]
