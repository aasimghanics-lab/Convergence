#pragma once
#include <cstdint>
#include <optional>
#include <random>
#include <string>
#include <unordered_map>
#include <vector>

namespace skygrid {
using AircraftId = std::uint64_t;

struct Vec3 { double x{}, y{}, z{}; };

struct AircraftState {
    AircraftId id{};
    Vec3 position{};
    Vec3 velocity{};
    double heading{};
    double altitude{};
    double speed{};
    std::uint64_t version{1};
};

class Simulation {
public:
    Simulation(std::string shard_id, double tick_hz = 60.0);
    void seed(std::size_t count);
    void tick();
    void upsert(const AircraftState& state);
    void erase(AircraftId id);
    std::vector<AircraftState> states() const;
    std::vector<AircraftState> outbound() const;
    double dt() const noexcept;
    const std::string& shard_id() const noexcept;
private:
    bool owns_position(double x) const;
    std::string shard_id_;
    double tick_hz_;
    std::unordered_map<AircraftId, AircraftState> aircraft_;
};
std::string state_json(const AircraftState& s);
std::optional<AircraftState> parse_state_fields(const std::string& line);
}
