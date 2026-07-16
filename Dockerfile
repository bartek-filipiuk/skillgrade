# Static SkillGrade hub — nginx serving the self-contained index.html.
# index.html has the catalog inlined; catalog.json is copied too for reference.
FROM nginx:alpine
COPY hub/index.html /usr/share/nginx/html/index.html
COPY hub/catalog.json /usr/share/nginx/html/catalog.json
EXPOSE 80
