terraform {
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 6.0" }
  }
}
provider "aws" { region = var.aws_region }
module "vpc" {
  source = "terraform-aws-modules/vpc/aws"
  version = "~> 6.0"
  name = "skygrid"
  cidr = "10.42.0.0/16"
  azs = ["${var.aws_region}a", "${var.aws_region}b"]
  private_subnets = ["10.42.1.0/24", "10.42.2.0/24"]
  public_subnets = ["10.42.101.0/24", "10.42.102.0/24"]
  enable_nat_gateway = true
  single_nat_gateway = true
}
module "eks" {
  source = "terraform-aws-modules/eks/aws"
  version = "~> 21.0"
  cluster_name = "skygrid"
  kubernetes_version = "1.33"
  subnet_ids = module.vpc.private_subnets
  vpc_id = module.vpc.vpc_id
  eks_managed_node_groups = {
    simulation = {
      instance_types = ["c7i.large"]
      min_size = 2
      max_size = 6
      desired_size = 3
    }
  }
}
