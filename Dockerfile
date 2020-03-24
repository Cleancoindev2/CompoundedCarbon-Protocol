FROM mhart/alpine-node:11.10.1

RUN apk update && apk add --no-cache --virtual build-dependencies git python g++ make
RUN yarn global add truffle@5.0.30
RUN yarn global add ganache-cli@6.5.1
RUN yarn global add typescript

RUN wget https://github.com/ethereum/solidity/releases/download/v0.5.8/solc-static-linux -O /usr/local/bin/solc && \
	chmod +x /usr/local/bin/solc

RUN mkdir -p /deploy/CompoundedCarbon-Protocol/scenario
WORKDIR /deploy/compound-protocol

# First add deps
ADD ./package.json /deploy/CompoundedCarbon-Protocol/
ADD ./yarn.lock /deploy/CompoundedCarbon-Protocol/
RUN yarn install
ADD scenario/package.json /deploy/CompoundedCarbon-Protocol/scenario
ADD scenario/yarn.lock /deploy/CompoundedCarbon-Protocol/scenario
RUN ls -la /deploy/CompoundedCarbon-Protocol
RUN ls -la /deploy/CompoundedCarbon-Protocol/scenario
RUN cd /deploy/CompoundedCarbon-Protocol/scenario && yarn install

# Then rest of code and build
ADD . /deploy/CompoundedCarbon-Protocol

RUN truffle compile

RUN apk del build-dependencies
RUN yarn cache clean

CMD while :; do sleep 2073600; done
