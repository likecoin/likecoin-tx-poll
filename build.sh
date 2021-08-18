#!/usr/bin/env bash

PWD=`pwd`
WD=`cd $(dirname "$0") && pwd -P`

cd "${WD}"

docker build . -t like-txpoll:latest
docker tag like-txpoll:latest us.gcr.io/likecoin-foundation/like-txpoll:latest
docker -- push us.gcr.io/likecoin-foundation/like-txpoll:latest

cd "${PWD}"
