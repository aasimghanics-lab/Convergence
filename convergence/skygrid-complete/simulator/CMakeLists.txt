cmake_minimum_required(VERSION 3.20)
project(skygrid_simulator LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_executable(skygrid-sim
    src/main.cpp
    src/simulation.cpp
)

target_include_directories(skygrid-sim PRIVATE include)

enable_testing()
add_executable(skygrid-sim-tests tests.cpp src/simulation.cpp)
target_include_directories(skygrid-sim-tests PRIVATE include)
add_test(NAME simulation_tests COMMAND skygrid-sim-tests)
