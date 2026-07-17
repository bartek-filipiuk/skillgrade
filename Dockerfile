# Static SkillGrade hub — nginx serving the self-contained index.html + catalog data.
FROM nginx:alpine
RUN printf 'gzip on;\ngzip_types application/json application/javascript text/css;\ngzip_min_length 1024;\n' > /etc/nginx/conf.d/gzip.conf
COPY hub/index.html /usr/share/nginx/html/index.html
COPY hub/client-search.js /usr/share/nginx/html/client-search.js
COPY hub/catalog.json /usr/share/nginx/html/catalog.json
COPY hub/catalog-index.json /usr/share/nginx/html/catalog-index.json
COPY hub/skills/ /usr/share/nginx/html/skills/
EXPOSE 80
