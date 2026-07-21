# Development stage
FROM node:20-alpine AS development

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm install

COPY . .

# Run the app in watch mode
CMD ["npm", "run", "start:dev"]

# Build stage
FROM node:20-alpine AS build

WORKDIR /usr/src/app

COPY package*.json ./
# In order to run `npm run build` we need access to the Nest CLI which is a dev dependency.
RUN npm install

COPY . .

RUN npm run build

# Production stage
FROM node:20-alpine AS production

ARG NODE_ENV=production
ENV NODE_ENV=${NODE_ENV}

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm install --only=production

COPY --from=build /usr/src/app/dist ./dist

CMD ["npm", "run", "start:prod"]
