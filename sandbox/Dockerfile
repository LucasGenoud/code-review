# Isolated runner for LLM-written code. Isolation is set in docker-compose.yml:
# no network, read-only root fs, repos read-only, capped memory and processes.
# Jobs run as `nobody` (setpriv, from util-linux).
FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 default-jdk-headless \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /runner
COPY runner.mjs .
ENV SANDBOX_DIR=/sandbox REPO_ROOT=/repos
CMD ["node", "runner.mjs"]
