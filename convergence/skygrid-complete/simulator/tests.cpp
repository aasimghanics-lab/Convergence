#include "simulation.hpp"
#include <cassert>
#include <iostream>
int main() {
  skygrid::Simulation west("west", 60.0);
  west.seed(10);
  auto before = west.states();
  assert(before.size() == 10);
  auto x = before.front().position.x;
  for (int i=0;i<60;i++) west.tick();
  auto after = west.states();
  bool moved=false;
  for (auto &s: after) if (s.id==before.front().id && s.position.x!=x) moved=true;
  assert(moved);
  skygrid::AircraftState external{999, {0,0,0}, {1,0,0}, 90, 10000, 300, 2};
  west.upsert(external);
  assert(!west.outbound().empty());
  west.erase(999);
  assert(west.states().size()==10);
  std::cout << "simulation tests passed\n";
}
