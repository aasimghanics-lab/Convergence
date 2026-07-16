#include "simulation.hpp"
#include <arpa/inet.h>
#include <chrono>
#include <cstdlib>
#include <iostream>
#include <netdb.h>
#include <sys/socket.h>
#include <thread>
#include <unistd.h>
#include <unordered_set>

namespace {
std::string env(const char* k, const char* d) { auto* v=std::getenv(k); return v?v:d; }
int connect_control(const std::string& host, const std::string& port) {
    addrinfo hints{}, *res=nullptr; hints.ai_family=AF_UNSPEC; hints.ai_socktype=SOCK_STREAM;
    if (getaddrinfo(host.c_str(),port.c_str(),&hints,&res)!=0) return -1;
    int fd=-1;
    for(auto* p=res;p;p=p->ai_next){ fd=socket(p->ai_family,p->ai_socktype,p->ai_protocol);
        if(fd>=0 && connect(fd,p->ai_addr,p->ai_addrlen)==0) break; if(fd>=0) close(fd); fd=-1; }
    freeaddrinfo(res); return fd;
}
bool send_line(int fd,const std::string& s){ std::string x=s+"\n"; size_t n=0;
    while(n<x.size()){ auto w=send(fd,x.data()+n,x.size()-n,0); if(w<=0)return false;n+=w;} return true; }
std::string type_of(const std::string& s){ auto p=s.find("\"type\":\""); if(p==std::string::npos)return "";
    p+=8; auto e=s.find('"',p); return s.substr(p,e-p); }
std::uint64_t id_of(const std::string& s){ auto p=s.find("\"id\":"); if(p==std::string::npos)return 0;
    return std::stoull(s.substr(p+5)); }
}

int main() {
    const auto shard=env("SHARD_ID","central"), host=env("CONTROL_HOST","localhost"), port=env("CONTROL_PORT","7000");
    const auto seed=static_cast<std::size_t>(std::stoull(env("SEED_COUNT","250")));
    skygrid::Simulation sim(shard,60.0); sim.seed(seed);
    std::unordered_set<skygrid::AircraftId> pending;

    for(;;) {
        int fd=connect_control(host,port); if(fd<0){std::this_thread::sleep_for(std::chrono::seconds(1));continue;}
        send_line(fd,"{\"type\":\"register\",\"shard\":\""+shard+"\"}");
        std::string buffer;
        auto next=std::chrono::steady_clock::now(); std::uint64_t tick=0;
        while(true){
            sim.tick(); ++tick;
            if(tick%60==0 && !send_line(fd,"{\"type\":\"heartbeat\",\"shard\":\""+shard+"\"}")) break;
            if(tick%6==0){
                for(auto& s:sim.states())
                    if(!send_line(fd,"{\"type\":\"telemetry\",\"shard\":\""+shard+"\","+skygrid::state_json(s)+"}")) goto disconnected;
                for(auto& s:sim.outbound()) if(!pending.count(s.id)){
                    pending.insert(s.id);
                    if(!send_line(fd,"{\"type\":\"handoff_prepare\",\"shard\":\""+shard+"\","+skygrid::state_json(s)+"}")) goto disconnected;
                }
            }
            {
                char chunk[65536]; auto n=recv(fd,chunk,sizeof(chunk),MSG_DONTWAIT);
                if(n>0){ buffer.append(chunk,n); size_t pos;
                    while((pos=buffer.find('\n'))!=std::string::npos){
                        auto line=buffer.substr(0,pos); buffer.erase(0,pos+1); auto t=type_of(line);
                        if(t=="handoff_accept"){ if(auto s=skygrid::parse_state_fields(line)){sim.upsert(*s);
                            send_line(fd,"{\"type\":\"handoff_ack\",\"shard\":\""+shard+"\",\"id\":"+std::to_string(s->id)+",\"version\":"+std::to_string(s->version)+"}");}}
                        else if(t=="handoff_commit"){ auto id=id_of(line); sim.erase(id); pending.erase(id); }
                    }
                } else if(n==0) break;
            }
            next += std::chrono::microseconds(16667); std::this_thread::sleep_until(next);
        }
disconnected:
        close(fd); std::this_thread::sleep_for(std::chrono::seconds(1));
    }
}
