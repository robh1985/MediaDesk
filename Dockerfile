FROM node:22-alpine
# ffmpeg lets the Preview app play any video or audio format. LibreOffice (large) adds high-quality
# previews of Office documents: build with --build-arg WITH_OFFICE=true to include it.
# Calibre lets the eBook Reader open AZW3, Word, RTF, ODT and LIT books (converted to EPUB). It's
# included unless you build with --build-arg WITH_CALIBRE=false (it adds a few hundred MB). Where
# Alpine has no Calibre package for the platform, the image is built without it and says so.
ARG WITH_OFFICE=false
ARG WITH_CALIBRE=true
RUN apk add --no-cache ffmpeg 7zip \
 && if [ "$WITH_OFFICE" = "true" ]; then apk add --no-cache libreoffice ttf-dejavu ttf-liberation; fi \
 && if [ "$WITH_CALIBRE" = "true" ]; then \
      apk add --no-cache calibre \
      || echo "WARNING: Calibre isn't available for this platform; the eBook Reader won't open AZW3, Word, RTF, ODT or LIT books." >&2; \
    fi
# Calibre's tools run without a screen.
ENV QT_QPA_PLATFORM=offscreen
WORKDIR /app
COPY package.json server.js files.js appsettings.js notify.js mock.js mock-plex.js mock-games.js mock-pikvm.js games.js pikvm.js wallpapers.js media.js archive.js family.js family-auth.js family-recipes.js ebooks.js mock-ebooks.js smtp.js trips.js artmatch.js ./
COPY public ./public
ENV NODE_ENV=production PORT=8080 CONFIG_PATH=/config/config.json
VOLUME /config
EXPOSE 8080
USER node
CMD ["node", "server.js"]
