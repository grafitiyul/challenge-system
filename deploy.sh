#!/bin/bash

echo "Adding changes..."
git add .

if git diff --cached --quiet; then
  echo "No changes to commit"
  exit 0
fi

echo "Commit..."
git commit -m "$1"

echo "Pushing to GitHub..."
git push

echo "Done. Railway will deploy automatically."
