#!/usr/bin/env bash

echo $@

set -eu

BASE_DIR="$(dirname "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)")"
TMP_DIR=$(mktemp -d)
DEST="${TMP_DIR}/addon"
XPI="${XPI:-cloud-storage-study@shield.mozilla.org-v1.0.2.xpi}"
mkdir -p $DEST

# deletes the temp directory
function cleanup {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

echo $PWD

cp -rp addon/* $DEST

pushd $DEST
zip -r $DEST/${XPI} *
mkdir -p $BASE_DIR/dist
mv "${XPI}" $BASE_DIR/dist
echo "xpi at ${BASE_DIR}/dist/${XPI}"
popd
