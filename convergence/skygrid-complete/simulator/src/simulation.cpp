#include "simulation.hpp"
#include <cmath>
#include <iomanip>
#include <sstream>

namespace skygrid {
namespace {
constexpr double kKnotsToMps = 0.514444;
constexpr double kPi = 3.14159265358979323846;
double field(const std::string& s, const std::string& key) {
    auto p = s.find("\"" + key + "\":");
    if (p == std::string::npos) return 0;
    p += key.size() + 3;
    return std::stod(s.substr(p));
}
}

Simulation::Simulation(std::string shard_id, double tick_hz)
    : shard_id_(std::move(shard_id)), tick_hz_(tick_hz) {}

bool Simulation::owns_position(double x) const {
    if (shard_id_ == "west") return x < -20000.0;
    if (shard_id_ == "central") return x >= -20000.0 && x < 20000.0;
    return x >= 20000.0;
}

void Simulation::seed(std::size_t count) {
    std::uint64_t base = shard_id_ == "west" ? 1 : shard_id_ == "central" ? 1000001 : 2000001;
    std::mt19937_64 rng(base);
    double lo = shard_id_ == "west" ? -58000 : shard_id_ == "central" ? -19000 : 21000;
    double hi = shard_id_ == "west" ? -21000 : shard_id_ == "central" ? 19000 : 58000;
    std::uniform_real_distribution<double> xdist(lo, hi), zdist(-50000, 50000);
    std::uniform_real_distribution<double> alt(8000, 41000), speed(300, 520);
    std::uniform_int_distribution<int> direction(0, 1);
    for (std::size_t i=0; i<count; ++i) {
        double sp = speed(rng);
        double vx = (direction(rng) ? 1.0 : -1.0) * sp * kKnotsToMps;
        double heading = vx >= 0 ? 90.0 : 270.0;
        AircraftState s{base+i, {xdist(rng), alt(rng)/3.28084, zdist(rng)}, {vx,0,0},
                        heading, alt(rng), sp, 1};

        // Keep one deterministic boundary-crossing aircraft per shard.
        // This gives demos and integration tests a prompt, reproducible handoff
        // without changing the ownership protocol being exercised.
        if (i == 0) {
            if (shard_id_ == "west") {
                s.position.x = -20010.0;
                s.velocity.x = std::abs(s.velocity.x);
                s.heading = 90.0;
            } else if (shard_id_ == "central") {
                s.position.x = 19990.0;
                s.velocity.x = std::abs(s.velocity.x);
                s.heading = 90.0;
            } else {
                s.position.x = 20010.0;
                s.velocity.x = -std::abs(s.velocity.x);
                s.heading = 270.0;
            }
        }

        aircraft_[s.id] = s;
    }
}

void Simulation::tick() {
    for (auto& [id,s] : aircraft_) {
        s.position.x += s.velocity.x * dt();
        s.position.y += s.velocity.y * dt();
        s.position.z += s.velocity.z * dt();
        if (s.position.x > 60000) s.position.x = -60000;
        if (s.position.x < -60000) s.position.x = 60000;
    }
}
void Simulation::upsert(const AircraftState& s) {
    auto it = aircraft_.find(s.id);
    if (it == aircraft_.end() || s.version >= it->second.version) aircraft_[s.id] = s;
}
void Simulation::erase(AircraftId id) { aircraft_.erase(id); }
std::vector<AircraftState> Simulation::states() const {
    std::vector<AircraftState> out; out.reserve(aircraft_.size());
    for (auto& [id,s] : aircraft_) out.push_back(s);
    return out;
}
std::vector<AircraftState> Simulation::outbound() const {
    std::vector<AircraftState> out;
    for (auto& [id,s] : aircraft_) if (!owns_position(s.position.x)) out.push_back(s);
    return out;
}
double Simulation::dt() const noexcept { return 1.0/tick_hz_; }
const std::string& Simulation::shard_id() const noexcept { return shard_id_; }

std::string state_json(const AircraftState& s) {
    std::ostringstream o; o << std::fixed << std::setprecision(3)
      << "\"id\":" << s.id << ",\"x\":" << s.position.x << ",\"y\":" << s.position.y
      << ",\"z\":" << s.position.z << ",\"vx\":" << s.velocity.x << ",\"vy\":" << s.velocity.y
      << ",\"vz\":" << s.velocity.z << ",\"heading\":" << s.heading
      << ",\"altitude\":" << s.altitude << ",\"speed\":" << s.speed
      << ",\"version\":" << s.version;
    return o.str();
}
std::optional<AircraftState> parse_state_fields(const std::string& line) {
    try {
        AircraftState s;
        s.id = static_cast<AircraftId>(field(line,"id")); s.position={field(line,"x"),field(line,"y"),field(line,"z")};
        s.velocity={field(line,"vx"),field(line,"vy"),field(line,"vz")}; s.heading=field(line,"heading");
        s.altitude=field(line,"altitude"); s.speed=field(line,"speed");
        s.version=static_cast<std::uint64_t>(field(line,"version"));
        return s;
    } catch (...) { return std::nullopt; }
}
}
