FROM gcc:14 AS build
RUN apt-get update && apt-get install -y cmake && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY . .
RUN cmake -S . -B build && cmake --build build -j

# Keep the runtime ABI identical to the build stage. The previous
# debian:bookworm-slim runtime shipped older glibc/libstdc++ and crashed
# before shard registration with GLIBC/GLIBCXX version errors.
FROM gcc:14
COPY --from=build /app/build/skygrid-sim /usr/local/bin/skygrid-sim
CMD ["skygrid-sim"]
