package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestDestinationBoundaries(t *testing.T) {
	cases := []struct {
		x    float64
		want string
	}{{-20001, "west"}, {-20000, "central"}, {19999, "central"}, {20000, "east"}}
	for _, tc := range cases {
		if got := destination(tc.x); got != tc.want {
			t.Fatalf("destination(%v)=%s want %s", tc.x, got, tc.want)
		}
	}
}

func TestStoreReplayAndSnapshot(t *testing.T) {
	dir := t.TempDir()
	store := &Store{path: filepath.Join(dir, "events.jsonl")}
	a := Aircraft{ID: 42, Shard: "west", Version: 1}
	store.append(Event{Type: "telemetry", Shard: "west", Aircraft: &a, At: time.Now()})
	store.append(Event{Type: "recovery", Shard: "east", Aircraft: &Aircraft{ID: 7}, At: time.Now()})
	got := store.replay(42)
	if len(got) != 1 || got[0].Type != "telemetry" {
		t.Fatalf("unexpected replay: %#v", got)
	}
	if err := store.snapshot(map[string]any{"aircraft": []Aircraft{a}}); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(store.path + ".snapshot.json"); err != nil {
		t.Fatal(err)
	}
}

func TestMetricsText(t *testing.T) {
	c := newControl(&Store{path: filepath.Join(t.TempDir(), "events.jsonl")}, time.Second)
	c.aircraft[1] = Aircraft{ID: 1, Shard: "west"}
	c.metrics.telemetry.Add(3)
	c.metrics.handoffs.Add(2)
	c.metrics.recoveries.Add(1)
	out := c.metricsText()
	for _, want := range []string{"skygrid_telemetry_events_total 3", "skygrid_handoffs_total 2", "skygrid_recoveries_total 1", "skygrid_active_aircraft 1", "shard=\"west\"} 1"} {
		if !strings.Contains(out, want) {
			t.Fatalf("metrics missing %q:\n%s", want, out)
		}
	}
}
