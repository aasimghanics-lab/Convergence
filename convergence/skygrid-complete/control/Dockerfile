FROM golang:1.23 AS build
WORKDIR /app
COPY go.mod ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /skygrid-control ./cmd/control
FROM alpine:3.21
COPY --from=build /skygrid-control /usr/local/bin/skygrid-control
EXPOSE 7000 8080
CMD ["skygrid-control"]
