package main

import (
	"bufio"
	"crypto/rand"
	"encoding/base64"
	"encoding/binary"
	"flag"
	"fmt"
	"io"
	"net"
	"net/url"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

func dialWS(raw string) (net.Conn, *bufio.Reader, error) {
	u, err := url.Parse(raw)
	if err != nil {
		return nil, nil, err
	}
	host := u.Host
	if !strings.Contains(host, ":") {
		host += ":80"
	}
	c, err := net.Dial("tcp", host)
	if err != nil {
		return nil, nil, err
	}
	keyb := make([]byte, 16)
	rand.Read(keyb)
	key := base64.StdEncoding.EncodeToString(keyb)
	path := u.RequestURI()
	fmt.Fprintf(c, "GET %s HTTP/1.1\r\nHost: %s\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: %s\r\nSec-WebSocket-Version: 13\r\n\r\n", path, u.Host, key)
	r := bufio.NewReader(c)
	line, err := r.ReadString('\n')
	if err != nil {
		c.Close()
		return nil, nil, err
	}
	if !strings.Contains(line, "101") {
		c.Close()
		return nil, nil, fmt.Errorf("upgrade failed: %s", strings.TrimSpace(line))
	}
	for {
		l, e := r.ReadString('\n')
		if e != nil {
			c.Close()
			return nil, nil, e
		}
		if l == "\r\n" {
			break
		}
	}
	return c, r, nil
}
func readFrame(r *bufio.Reader) (int, error) {
	h := make([]byte, 2)
	if _, e := io.ReadFull(r, h); e != nil {
		return 0, e
	}
	n := uint64(h[1] & 0x7f)
	if n == 126 {
		b := make([]byte, 2)
		io.ReadFull(r, b)
		n = uint64(binary.BigEndian.Uint16(b))
	} else if n == 127 {
		b := make([]byte, 8)
		io.ReadFull(r, b)
		n = binary.BigEndian.Uint64(b)
	}
	if h[1]&0x80 != 0 {
		mask := make([]byte, 4)
		io.ReadFull(r, mask)
	}
	if n > 64*1024*1024 {
		return 0, fmt.Errorf("frame too large")
	}
	payload := make([]byte, int(n))
	_, e := io.ReadFull(r, payload)
	return int(n), e
}
func main() {
	clients := flag.Int("clients", 100, "clients")
	duration := flag.Duration("duration", 30*time.Second, "duration")
	addr := flag.String("url", "ws://localhost:8080/ws", "url")
	flag.Parse()
	var messages, bytes atomic.Uint64
	var wg sync.WaitGroup
	start := time.Now()
	deadline := start.Add(*duration)
	for i := 0; i < *clients; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			c, r, e := dialWS(*addr)
			if e != nil {
				return
			}
			defer c.Close()
			c.SetReadDeadline(deadline)
			for {
				n, e := readFrame(r)
				if e != nil {
					return
				}
				messages.Add(1)
				bytes.Add(uint64(n))
			}
		}()
	}
	wg.Wait()
	elapsed := time.Since(start).Seconds()
	fmt.Printf("clients=%d duration=%.2fs messages=%d messages_per_sec=%.2f bytes=%d MiB_per_sec=%.2f\n", *clients, elapsed, messages.Load(), float64(messages.Load())/elapsed, bytes.Load(), float64(bytes.Load())/elapsed/1024/1024)
}
