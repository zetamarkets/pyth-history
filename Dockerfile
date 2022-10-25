FROM public.ecr.aws/bitnami/node:16

# Create app directory
WORKDIR /usr/app

# Install app dependencies
# A wildcard is used to ensure both package.json AND package-lock.json are copied
# where available (npm@5+)
COPY package*.json ./

# Bundle app source
COPY . .

RUN yarn install
# If you are building your code for production
# RUN npm ci --only=production

EXPOSE 5000
# Add "--debug" to this array to not push anything to AWS buckets
CMD [ "yarn", "run", "start"]