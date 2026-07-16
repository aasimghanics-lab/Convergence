package main

import (
	"bufio"
	"context"
	"crypto/sha1"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

type Aircraft struct {
	ID       uint64  `json:"id"`
	X        float64 `json:"x"`
	Y        float64 `json:"y"`
	Z        float64 `json:"z"`
	VX       float64 `json:"vx"`
	VY       float64 `json:"vy"`
	VZ       float64 `json:"vz"`
	Heading  float64 `json:"heading"`
	Altitude float64 `json:"altitude"`
	Speed    float64 `json:"speed"`
	Version  uint64  `json:"version"`
	Shard    string  `json:"shard"`
}
type Event struct {
	Type     string    `json:"type"`
	Shard    string    `json:"shard,omitempty"`
	Aircraft *Aircraft `json:"aircraft,omitempty"`
	ID       uint64    `json:"id,omitempty"`
	Version  uint64    `json:"version,omitempty"`
	At       time.Time `json:"at"`
}
type Shard struct {
	ID            string    `json:"id"`
	Healthy       bool      `json:"healthy"`
	LastHeartbeat time.Time `json:"lastHeartbeat"`
	Aircraft      int       `json:"aircraft"`
	conn          net.Conn
	mu            sync.Mutex
}
type pendingHandoff struct {
	Source, Destination string
	State               Aircraft
}

type WSConn struct {
	conn net.Conn
	mu   sync.Mutex
}

func (c *WSConn) WriteText(payload []byte) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	var h []byte
	n := len(payload)
	switch {
	case n < 126:
		h = []byte{0x81, byte(n)}
	case n <= 65535:
		h = make([]byte, 4)
		h[0] = 0x81
		h[1] = 126
		binary.BigEndian.PutUint16(h[2:], uint16(n))
	default:
		h = make([]byte, 10)
		h[0] = 0x81
		h[1] = 127
		binary.BigEndian.PutUint64(h[2:], uint64(n))
	}
	if err := c.conn.SetWriteDeadline(time.Now().Add(time.Second)); err != nil {
		return err
	}
	if _, err := c.conn.Write(h); err != nil {
		return err
	}
	_, err := c.conn.Write(payload)
	return err
}
func (c *WSConn) Close() { c.conn.Close() }

type Hub struct {
	mu      sync.RWMutex
	clients map[*WSConn]struct{}
}

func newHub() *Hub              { return &Hub{clients: map[*WSConn]struct{}{}} }
func (h *Hub) add(c *WSConn)    { h.mu.Lock(); h.clients[c] = struct{}{}; h.mu.Unlock() }
func (h *Hub) remove(c *WSConn) { h.mu.Lock(); delete(h.clients, c); h.mu.Unlock(); c.Close() }
func (h *Hub) broadcast(v any) {
	b, _ := json.Marshal(v)
	h.mu.RLock()
	cs := make([]*WSConn, 0, len(h.clients))
	for c := range h.clients {
		cs = append(cs, c)
	}
	h.mu.RUnlock()
	for _, c := range cs {
		if c.WriteText(b) != nil {
			h.remove(c)
		}
	}
}

func acceptWebSocket(w http.ResponseWriter, r *http.Request) (*WSConn, error) {
	if !strings.EqualFold(r.Header.Get("Upgrade"), "websocket") {
		return nil, errors.New("upgrade required")
	}
	key := r.Header.Get("Sec-WebSocket-Key")
	if key == "" {
		return nil, errors.New("missing websocket key")
	}
	hj, ok := w.(http.Hijacker)
	if !ok {
		return nil, errors.New("hijack unsupported")
	}
	conn, rw, err := hj.Hijack()
	if err != nil {
		return nil, err
	}
	sum := sha1.Sum([]byte(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"))
	accept := base64.StdEncoding.EncodeToString(sum[:])
	fmt.Fprintf(rw, "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: %s\r\n\r\n", accept)
	if err := rw.Flush(); err != nil {
		conn.Close()
		return nil, err
	}
	return &WSConn{conn: conn}, nil
}

type Store struct {
	mu   sync.Mutex
	path string
}

func (s *Store) append(e Event) {
	s.mu.Lock()
	defer s.mu.Unlock()
	f, err := os.OpenFile(s.path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0644)
	if err != nil {
		return
	}
	defer f.Close()
	json.NewEncoder(f).Encode(e)
}
func (s *Store) replay(id uint64) []Event {
	s.mu.Lock()
	defer s.mu.Unlock()
	f, err := os.Open(s.path)
	if err != nil {
		return []Event{}
	}
	defer f.Close()
	out := []Event{}
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 64*1024), 4*1024*1024)
	for sc.Scan() {
		var e Event
		if json.Unmarshal(sc.Bytes(), &e) == nil && ((e.Aircraft != nil && e.Aircraft.ID == id) || e.ID == id) {
			out = append(out, e)
		}
	}
	return out
}

func (s *Store) snapshot(v any) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	tmp := s.path + ".snapshot.tmp"
	final := s.path + ".snapshot.json"
	f, err := os.Create(tmp)
	if err != nil {
		return err
	}
	encErr := json.NewEncoder(f).Encode(v)
	closeErr := f.Close()
	if encErr != nil {
		return encErr
	}
	if closeErr != nil {
		return closeErr
	}
	return os.Rename(tmp, final)
}

type Metrics struct {
	telemetry  atomic.Uint64
	handoffs   atomic.Uint64
	recoveries atomic.Uint64
}
type Control struct {
	mu          sync.RWMutex
	shards      map[string]*Shard
	disabled    map[string]bool
	aircraft    map[uint64]Aircraft
	pending     map[uint64]pendingHandoff
	lastPersist map[uint64]time.Time
	hub         *Hub
	store       *Store
	timeout     time.Duration
	metrics     Metrics
}

func newControl(store *Store, timeout time.Duration) *Control {
	return &Control{shards: map[string]*Shard{}, disabled: map[string]bool{}, aircraft: map[uint64]Aircraft{}, pending: map[uint64]pendingHandoff{}, lastPersist: map[uint64]time.Time{}, hub: newHub(), store: store, timeout: timeout}
}
func destination(x float64) string {
	if x < -20000 {
		return "west"
	}
	if x < 20000 {
		return "central"
	}
	return "east"
}
func (c *Control) send(shard string, v any) bool {
	c.mu.RLock()
	s := c.shards[shard]
	c.mu.RUnlock()
	if s == nil || !s.Healthy {
		return false
	}
	b, _ := json.Marshal(v)
	s.mu.Lock()
	defer s.mu.Unlock()
	s.conn.SetWriteDeadline(time.Now().Add(time.Second))
	_, err := fmt.Fprintf(s.conn, "%s\n", b)
	return err == nil
}
func (c *Control) register(id string, conn net.Conn) {
	c.mu.Lock()
	if c.disabled[id] {
		c.mu.Unlock()
		_ = conn.Close()
		return
	}
	if old := c.shards[id]; old != nil && old.conn != conn {
		_ = old.conn.Close()
	}
	c.shards[id] = &Shard{ID: id, Healthy: true, LastHeartbeat: time.Now(), conn: conn}
	c.mu.Unlock()
	log.Printf("shard registered: %s", id)
}
func (c *Control) process(raw []byte, conn net.Conn) {
	var head struct {
		Type, Shard string
		ID, Version uint64
	}
	if json.Unmarshal(raw, &head) != nil {
		return
	}
	switch head.Type {
	case "register":
		c.register(head.Shard, conn)
	case "heartbeat":
		c.mu.Lock()
		if s := c.shards[head.Shard]; s != nil {
			s.LastHeartbeat = time.Now()
			s.Healthy = true
		}
		c.mu.Unlock()
	case "telemetry":
		var a Aircraft
		if json.Unmarshal(raw, &a) != nil {
			return
		}
		a.Shard = head.Shard
		c.mu.Lock()
		old, ok := c.aircraft[a.ID]
		if !ok || a.Version >= old.Version {
			c.aircraft[a.ID] = a
		}
		c.mu.Unlock()
		c.metrics.telemetry.Add(1)
		now := time.Now()
		c.mu.Lock()
		last := c.lastPersist[a.ID]
		shouldPersist := now.Sub(last) >= time.Second
		if shouldPersist {
			c.lastPersist[a.ID] = now
		}
		c.mu.Unlock()
		if shouldPersist {
			c.store.append(Event{Type: "telemetry", Shard: head.Shard, Aircraft: &a, At: now})
		}
	case "handoff_prepare":
		var a Aircraft
		if json.Unmarshal(raw, &a) != nil {
			return
		}
		a.Shard = head.Shard
		dest := destination(a.X)
		if dest == head.Shard {
			return
		}
		c.mu.Lock()
		old, ok := c.aircraft[a.ID]
		if ok && a.Version < old.Version {
			c.mu.Unlock()
			return
		}
		a.Version++
		a.Shard = dest
		c.pending[a.ID] = pendingHandoff{Source: head.Shard, Destination: dest, State: a}
		c.mu.Unlock()
		if c.send(dest, map[string]any{"type": "handoff_accept", "id": a.ID, "x": a.X, "y": a.Y, "z": a.Z, "vx": a.VX, "vy": a.VY, "vz": a.VZ, "heading": a.Heading, "altitude": a.Altitude, "speed": a.Speed, "version": a.Version}) {
			c.store.append(Event{Type: "handoff_prepare", Shard: head.Shard, Aircraft: &a, At: time.Now()})
		}
	case "handoff_ack":
		c.mu.Lock()
		p, ok := c.pending[head.ID]
		if ok && head.Version == p.State.Version {
			c.aircraft[head.ID] = p.State
			delete(c.pending, head.ID)
		}
		c.mu.Unlock()
		if ok {
			c.send(p.Source, map[string]any{"type": "handoff_commit", "id": head.ID, "version": head.Version})
			c.metrics.handoffs.Add(1)
			c.store.append(Event{Type: "handoff_commit", Shard: p.Destination, Aircraft: &p.State, At: time.Now()})
		}
	}
}
func (c *Control) serveShard(conn net.Conn) {
	defer conn.Close()
	sc := bufio.NewScanner(conn)
	sc.Buffer(make([]byte, 64*1024), 4*1024*1024)
	for sc.Scan() {
		c.process(append([]byte(nil), sc.Bytes()...), conn)
	}
}
func (c *Control) snapshot() map[string]any {
	c.mu.RLock()
	defer c.mu.RUnlock()
	planes := make([]Aircraft, 0, len(c.aircraft))
	counts := map[string]int{}
	for _, a := range c.aircraft {
		planes = append(planes, a)
		counts[a.Shard]++
	}
	shards := make([]map[string]any, 0, len(c.shards))
	for id, s := range c.shards {
		shards = append(shards, map[string]any{"id": id, "healthy": s.Healthy, "lastHeartbeat": s.LastHeartbeat, "aircraft": counts[id]})
	}
	return map[string]any{"type": "snapshot", "aircraft": planes, "shards": shards, "timestamp": time.Now()}
}
func (c *Control) monitor() {
	t := time.NewTicker(time.Second)
	defer t.Stop()
	for range t.C {
		failed := []string{}
		c.mu.Lock()
		for id, s := range c.shards {
			if s.Healthy && time.Since(s.LastHeartbeat) > c.timeout {
				s.Healthy = false
				failed = append(failed, id)
			}
		}
		c.mu.Unlock()
		for _, id := range failed {
			log.Printf("shard timeout: %s", id)
			c.recover(id)
		}
	}
}
func (c *Control) recover(id string) {
	c.mu.RLock()
	orphaned := []Aircraft{}
	for _, a := range c.aircraft {
		if a.Shard == id {
			orphaned = append(orphaned, a)
		}
	}
	c.mu.RUnlock()
	for _, a := range orphaned {
		dest := destination(a.X)
		if dest == id {
			if id == "west" {
				dest = "central"
			} else if id == "east" {
				dest = "central"
			} else if a.X < 0 {
				dest = "west"
			} else {
				dest = "east"
			}
		}
		a.Version++
		a.Shard = dest
		if c.send(dest, map[string]any{"type": "handoff_accept", "id": a.ID, "x": a.X, "y": a.Y, "z": a.Z, "vx": a.VX, "vy": a.VY, "vz": a.VZ, "heading": a.Heading, "altitude": a.Altitude, "speed": a.Speed, "version": a.Version}) {
			c.mu.Lock()
			c.aircraft[a.ID] = a
			c.mu.Unlock()
			c.metrics.recoveries.Add(1)
			c.store.append(Event{Type: "recovery", Shard: dest, Aircraft: &a, At: time.Now()})
		}
	}
}
func (c *Control) terminate(id string) bool {
	c.mu.Lock()
	s := c.shards[id]
	if s == nil {
		c.mu.Unlock()
		return false
	}
	c.disabled[id] = true
	s.Healthy = false
	s.LastHeartbeat = time.Time{}
	_ = s.conn.Close()
	c.mu.Unlock()
	go c.recover(id)
	return true
}
func (c *Control) metricsText() string {
	c.mu.RLock()
	counts := map[string]int{}
	for _, a := range c.aircraft {
		counts[a.Shard]++
	}
	active := len(c.aircraft)
	c.mu.RUnlock()
	var b strings.Builder
	fmt.Fprintf(&b, "# TYPE skygrid_telemetry_events_total counter\nskygrid_telemetry_events_total %d\n", c.metrics.telemetry.Load())
	fmt.Fprintf(&b, "# TYPE skygrid_handoffs_total counter\nskygrid_handoffs_total %d\n", c.metrics.handoffs.Load())
	fmt.Fprintf(&b, "# TYPE skygrid_recoveries_total counter\nskygrid_recoveries_total %d\n", c.metrics.recoveries.Load())
	fmt.Fprintf(&b, "# TYPE skygrid_active_aircraft gauge\nskygrid_active_aircraft %d\n", active)
	for _, id := range []string{"west", "central", "east"} {
		fmt.Fprintf(&b, "skygrid_shard_aircraft{shard=\"%s\"} %d\n", id, counts[id])
	}
	return b.String()
}
func main() {
	data := env("DATA_DIR", "./data")
	os.MkdirAll(data, 0755)
	timeout, _ := time.ParseDuration(env("SHARD_TIMEOUT", "4s"))
	c := newControl(&Store{path: filepath.Join(data, "events.jsonl")}, timeout)
	ln, err := net.Listen("tcp", ":7000")
	if err != nil {
		log.Fatal(err)
	}
	go func() {
		for {
			conn, err := ln.Accept()
			if err == nil {
				go c.serveShard(conn)
			}
		}
	}()
	go c.monitor()
	go func() {
		t := time.NewTicker(5 * time.Second)
		defer t.Stop()
		for range t.C {
			_ = c.store.snapshot(c.snapshot())
		}
	}()
	go func() {
		t := time.NewTicker(100 * time.Millisecond)
		for range t.C {
			c.hub.broadcast(c.snapshot())
		}
	}()
	http.HandleFunc("/metrics", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain; version=0.0.4")
		io.WriteString(w, c.metricsText())
	})
	http.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) { w.Write([]byte("ok")) })
	http.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
		conn, err := acceptWebSocket(w, r)
		if err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		c.hub.add(conn)
		defer c.hub.remove(conn)
		<-r.Context().Done()
	})
	http.HandleFunc("/api/status", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(c.snapshot())
	})
	http.HandleFunc("/api/aircraft/", func(w http.ResponseWriter, r *http.Request) {
		parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
		if len(parts) == 4 && parts[3] == "replay" {
			id, _ := strconv.ParseUint(parts[2], 10, 64)
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(c.store.replay(id))
			return
		}
		http.NotFound(w, r)
	})
	http.HandleFunc("/api/shards/", func(w http.ResponseWriter, r *http.Request) {
		parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
		if len(parts) != 4 || r.Method != "POST" {
			http.NotFound(w, r)
			return
		}
		id, action := parts[2], parts[3]
		ok := false
		if action == "terminate" {
			ok = c.terminate(id)
		} else if action == "recover" {
			c.mu.Lock()
			if _, exists := c.shards[id]; exists {
				delete(c.disabled, id)
				ok = true
			}
			c.mu.Unlock()
		}
		if !ok {
			http.Error(w, "shard not found", 404)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"ok": true, "shard": id, "action": action})
	})
	port := env("HTTP_PORT", "8080")
	log.Printf("control plane http :%s shard tcp :7000", port)
	log.Fatal(http.ListenAndServe(":"+port, nil))
}
func env(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}

var _ = context.Background
